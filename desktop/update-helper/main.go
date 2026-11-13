package main

import (
	"archive/zip"
	"crypto/ed25519"
	"crypto/sha512"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Injected by the release build, never read from a downloaded job.
var updatePublicKey string

type Manifest struct {
	Schema   int    `json:"schema"`
	Version  string `json:"version"`
	Platform string `json:"platform"`
	Arch     string `json:"arch"`
	File     string `json:"file"`
	Size     int64  `json:"size"`
	SHA512   string `json:"sha512"`
}
type Envelope struct {
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
}
type Marker struct {
	Version      string `json:"version"`
	Distribution string `json:"distribution"`
}
type Job struct {
	Root           string `json:"root"`
	CurrentVersion string `json:"currentVersion"`
	ParentPid      int    `json:"parentPid"`
	Token          string `json:"token"`
	UserData       string `json:"userData"`
}

func readJSON(name string, v any) error {
	f, e := os.Open(name)
	if e != nil {
		return e
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, 150001))
	if e != nil {
		return e
	}
	if len(b) > 150000 {
		return errors.New("metadata too large")
	}
	return json.Unmarshal(b, v)
}
func status(folder, phase, code string) {
	b, _ := json.Marshal(map[string]string{"phase": phase, "code": code})
	temp := filepath.Join(folder, "status.tmp")
	if os.WriteFile(temp, b, 0600) == nil {
		_ = os.Rename(temp, filepath.Join(folder, "status.json"))
	}
}
func manifest(folder string) (Manifest, error) {
	var m Manifest
	var env Envelope
	if e := readJSON(filepath.Join(folder, "manifest.json"), &env); e != nil {
		return m, e
	}
	data, e := base64.StdEncoding.DecodeString(env.Payload)
	if e != nil {
		return m, e
	}
	sig, e := base64.StdEncoding.DecodeString(env.Signature)
	if e != nil {
		return m, e
	}
	der, e := base64.StdEncoding.DecodeString(updatePublicKey)
	if e != nil {
		return m, e
	}
	key, e := x509.ParsePKIXPublicKey(der)
	if e != nil {
		return m, e
	}
	pub, ok := key.(ed25519.PublicKey)
	if !ok || !ed25519.Verify(pub, data, sig) {
		return m, errors.New("signature invalid")
	}
	if e = json.Unmarshal(data, &m); e != nil {
		return m, e
	}
	if m.Schema != 1 || m.Platform != "win32" || m.Arch != "x64" || m.File != "joincraft-"+m.Version+"-win-x64.zip" || m.Size <= 0 || m.Size > 512*1024*1024 || len(m.SHA512) != 128 {
		return m, errors.New("manifest invalid")
	}
	return m, nil
}
func verifyArchive(name string, m Manifest) error {
	f, e := os.Open(name)
	if e != nil {
		return e
	}
	defer f.Close()
	h := sha512.New()
	n, e := io.Copy(h, io.LimitReader(f, m.Size+1))
	if e != nil {
		return e
	}
	if n != m.Size || hex.EncodeToString(h.Sum(nil)) != m.SHA512 {
		return errors.New("checksum invalid")
	}
	return nil
}
func safeName(name string) bool {
	if name == "" || strings.ContainsAny(name, "\\:\x00") || strings.HasPrefix(name, "/") {
		return false
	}
	for _, part := range strings.Split(strings.TrimSuffix(name, "/"), "/") {
		if part == "" || part == "." || part == ".." || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") {
			return false
		}
		stem := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
		if stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" || len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) && stem[3] >= '0' && stem[3] <= '9' {
			return false
		}
	}
	return true
}
func extract(name, dest string) error {
	r, e := zip.OpenReader(name)
	if e != nil {
		return e
	}
	defer r.Close()
	if len(r.File) > 20000 {
		return errors.New("too many files")
	}
	seen := map[string]bool{}
	var total uint64
	for _, f := range r.File {
		if !safeName(f.Name) || f.Mode()&os.ModeSymlink != 0 || !f.FileInfo().IsDir() && !f.Mode().IsRegular() {
			return errors.New("unsafe ZIP path")
		}
		key := strings.ToLower(strings.TrimSuffix(f.Name, "/"))
		if seen[key] {
			return errors.New("duplicate ZIP path")
		}
		seen[key] = true
		if f.UncompressedSize64 > 2*1024*1024*1024-total {
			return errors.New("ZIP too large")
		}
		total += f.UncompressedSize64
		if total > 2*1024*1024*1024 {
			return errors.New("ZIP too large")
		}
		target := filepath.Join(dest, filepath.FromSlash(f.Name))
		if f.FileInfo().IsDir() {
			if e = os.MkdirAll(target, 0755); e != nil {
				return e
			}
			continue
		}
		if e = os.MkdirAll(filepath.Dir(target), 0755); e != nil {
			return e
		}
		src, e := f.Open()
		if e != nil {
			return e
		}
		out, e := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if e != nil {
			src.Close()
			return e
		}
		n, copyErr := io.Copy(out, io.LimitReader(src, int64(f.UncompressedSize64)+1))
		closeErr := out.Close()
		src.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if uint64(n) != f.UncompressedSize64 {
			return errors.New("ZIP size mismatch")
		}
	}
	return nil
}
func checkMarker(root, version string) error {
	var m Marker
	if e := readJSON(filepath.Join(root, "joincraft-release.json"), &m); e != nil {
		return e
	}
	if m.Distribution != "bundle" || m.Version != version {
		return errors.New("bundle version mismatch")
	}
	for _, name := range []string{"joincraft.exe", "resources/app.asar", "resources/updater/joincraft-update.exe"} {
		s, e := os.Stat(filepath.Join(root, filepath.FromSlash(name)))
		if e != nil {
			return e
		}
		if !s.Mode().IsRegular() || s.Size() == 0 {
			return errors.New("incomplete bundle")
		}
	}
	return nil
}

// NSIS adds these machine-local files after extracting the common application payload.
// Keep only this allowlist when replacing the directory, so uninstall and shortcuts
// continue to point to the same paths. Never copy arbitrary old application files.
func preserveInstallerFiles(root, stage string) error {
	const limit = int64(32 * 1024 * 1024)
	for _, name := range []string{"Uninstall joincraft.exe", "uninstallerIcon.ico"} {
		source := filepath.Join(root, name)
		info, e := os.Lstat(source)
		if os.IsNotExist(e) {
			continue
		}
		if e != nil {
			return e
		}
		if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > limit {
			return errors.New("invalid installer support file")
		}
		in, e := os.Open(source)
		if e != nil {
			return e
		}
		opened, e := in.Stat()
		if e != nil || !os.SameFile(info, opened) {
			in.Close()
			return errors.New("installer support file changed")
		}
		out, e := os.OpenFile(filepath.Join(stage, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
		if e != nil {
			in.Close()
			return e
		}
		count, copyErr := io.Copy(out, io.LimitReader(in, limit+1))
		closeErr := out.Close()
		in.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if count != info.Size() {
			return errors.New("installer support file size changed")
		}
	}
	return nil
}

func renameRetry(from, to string) error {
	var e error
	for deadline := time.Now().Add(25 * time.Second); time.Now().Before(deadline); {
		if e = os.Rename(from, to); e == nil {
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	return e
}

// Each transition leaves either the original directory or its complete backup intact.
func activate(root, stage, backup string, start func(string) error, health func() string) (string, error) {
	if e := renameRetry(root, backup); e != nil {
		_ = start(root)
		return "failed", e
	}
	if e := os.Rename(stage, root); e != nil {
		if restore := os.Rename(backup, root); restore != nil {
			return "failed", fmt.Errorf("restore required: %w", restore)
		}
		_ = start(root)
		return "rolled-back", e
	}
	e := start(root)
	result := "exited"
	if e == nil {
		result = health()
	}
	if result == "healthy" {
		return "complete", nil
	}
	if result == "unconfirmed" {
		return "unconfirmed", nil
	}
	// Roll back only after our new process exited; never kill arbitrary user processes.
	failed := stage + "-failed"
	if e = os.Rename(root, failed); e != nil {
		return "unconfirmed", e
	}
	if e = os.Rename(backup, root); e != nil {
		_ = os.Rename(failed, root)
		return "unconfirmed", e
	}
	_ = start(root)
	return "rolled-back", errors.New("new client failed startup")
}
func run(folder string) error {
	var job Job
	if e := readJSON(filepath.Join(folder, "job.json"), &job); e != nil {
		return e
	}
	root, e := filepath.Abs(job.Root)
	if e != nil {
		return e
	}
	canonical, e := filepath.EvalSymlinks(root)
	if e != nil {
		return e
	}
	expected := filepath.Join(job.UserData, "bundle-updates", job.Token)
	if !regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`).MatchString(job.Token) || !strings.EqualFold(folder, expected) || !strings.EqualFold(root, canonical) || len(root) <= len(filepath.VolumeName(root))+1 || strings.HasPrefix(root, `\\`) || strings.HasPrefix(strings.ToLower(job.UserData)+string(os.PathSeparator), strings.ToLower(root)+string(os.PathSeparator)) {
		return errors.New("invalid update location")
	}
	if e = checkMarker(root, job.CurrentVersion); e != nil {
		return e
	}
	m, e := manifest(folder)
	if e != nil {
		return e
	}
	if !newer(m.Version, job.CurrentVersion) {
		return errors.New("version not newer")
	}
	archive := filepath.Join(folder, "update.zip")
	if e = verifyArchive(archive, m); e != nil {
		return e
	}
	stage := root + ".joincraft-new-" + job.Token
	backup := root + ".joincraft-old-" + job.Token
	if _, e = os.Lstat(backup); !os.IsNotExist(e) {
		return errors.New("backup exists")
	}
	if e = os.Mkdir(stage, 0755); e != nil {
		return e
	}
	defer os.RemoveAll(stage)
	if e = extract(archive, stage); e != nil {
		return e
	}
	if e = checkMarker(stage, m.Version); e != nil {
		return e
	}
	if e = preserveInstallerFiles(root, stage); e != nil {
		return e
	}
	wait, closeParent, e := parentHandle(job.ParentPid, filepath.Join(root, "joincraft.exe"))
	if e != nil {
		return e
	}
	defer closeParent()
	status(folder, "ready", "")
	if e = wait(); e != nil {
		return e
	}
	if _, e = os.Stat(filepath.Join(folder, "abort")); e == nil {
		return errors.New("update cancelled before replacement")
	}
	var exited chan error
	start := func(dir string) error {
		cmd := exec.Command(filepath.Join(dir, "joincraft.exe"), "--joincraft-update="+job.Token)
		cmd.Dir = dir
		detach(cmd)
		if e := cmd.Start(); e != nil {
			return e
		}
		exited = make(chan error, 1)
		go func() { exited <- cmd.Wait() }()
		return nil
	}
	health := func() string {
		deadline := time.Now().Add(60 * time.Second)
		for time.Now().Before(deadline) {
			var ack struct {
				Token   string `json:"token"`
				Version string `json:"version"`
			}
			if readJSON(filepath.Join(folder, "healthy.json"), &ack) == nil && ack.Token == job.Token && ack.Version == m.Version {
				return "healthy"
			}
			select {
			case <-exited:
				return "exited"
			default:
			}
			time.Sleep(200 * time.Millisecond)
		}
		return "unconfirmed"
	}
	phase, e := activate(root, stage, backup, start, health)
	status(folder, phase, "")
	if phase == "complete" {
		_ = os.Remove(archive)
	}
	if phase == "rolled-back" {
		return nil
	}
	return e
}
func main() {
	if len(os.Args) != 2 {
		return
	}
	folder, e := filepath.Abs(os.Args[1])
	if e != nil {
		return
	}
	if e = run(folder); e != nil {
		var state map[string]string
		if readJSON(filepath.Join(folder, "status.json"), &state) != nil || state["phase"] != "unconfirmed" {
			status(folder, "failed", "Update helper could not complete")
		}
	}
}

func newer(next, current string) bool {
	parse := func(v string) ([3]int, bool) {
		var values [3]int
		parts := strings.Split(v, ".")
		if len(parts) != 3 {
			return values, false
		}
		for i, p := range parts {
			if p == "" || len(p) > 1 && p[0] == '0' {
				return values, false
			}
			n, e := strconv.Atoi(p)
			if e != nil || n < 0 || strconv.Itoa(n) != p {
				return values, false
			}
			values[i] = n
		}
		return values, true
	}
	n, ok := parse(next)
	if !ok {
		return false
	}
	c, ok := parse(current)
	if !ok {
		return false
	}
	for i := range n {
		if n[i] != c[i] {
			return n[i] > c[i]
		}
	}
	return false
}
