package main

import (
	"archive/zip"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha512"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestManifestAuthenticity(t *testing.T) {
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	der, _ := x509.MarshalPKIXPublicKey(pub)
	updatePublicKey = base64.StdEncoding.EncodeToString(der)
	root := t.TempDir()
	m := Manifest{Schema: 1, Version: "0.9.5", Platform: "win32", Arch: "x64", File: "joincraft-0.9.5-win-x64.zip", Size: 1, SHA512: hex.EncodeToString(make([]byte, 64))}
	payload, _ := json.Marshal(m)
	signature := ed25519.Sign(key, payload)
	env := Envelope{base64.StdEncoding.EncodeToString(payload), base64.StdEncoding.EncodeToString(signature)}
	data, _ := json.Marshal(env)
	os.WriteFile(filepath.Join(root, "manifest.json"), data, 0600)
	if _, e := manifest(root); e != nil {
		t.Fatal(e)
	}
	payload[5] ^= 1
	env.Payload = base64.StdEncoding.EncodeToString(payload)
	data, _ = json.Marshal(env)
	os.WriteFile(filepath.Join(root, "manifest.json"), data, 0600)
	if _, e := manifest(root); e == nil {
		t.Fatal("tampering accepted")
	}
}
func TestZipPaths(t *testing.T) {
	for _, name := range []string{"../x", "/x", "C:/x", "x\\x", "x:stream", "NUL.txt", "x/../y", "x. ", "a/./b", "a//b", "COM1"} {
		if safeName(name) {
			t.Fatal("accepted", name)
		}
	}
	for _, name := range []string{"joincraft.exe", "resources/app.asar", "locales/zh-CN.pak"} {
		if !safeName(name) {
			t.Fatal("rejected", name)
		}
	}
}
func makeZip(t *testing.T, names []string, symlink bool) string {
	t.Helper()
	name := filepath.Join(t.TempDir(), "fixture.zip")
	f, _ := os.Create(name)
	w := zip.NewWriter(f)
	for _, n := range names {
		h := &zip.FileHeader{Name: n}
		if symlink {
			h.SetMode(os.ModeSymlink | 0777)
		}
		entry, e := w.CreateHeader(h)
		if e != nil {
			t.Fatal(e)
		}
		entry.Write([]byte("fixture"))
	}
	w.Close()
	f.Close()
	return name
}
func TestExtractionRejectsUnsafeEntries(t *testing.T) {
	for _, names := range [][]string{{"../escape"}, {"a.txt", "A.txt"}} {
		if e := extract(makeZip(t, names, false), t.TempDir()); e == nil {
			t.Fatal("unsafe ZIP accepted")
		}
	}
	if e := extract(makeZip(t, []string{"link"}, true), t.TempDir()); e == nil {
		t.Fatal("symlink accepted")
	}
	dest := t.TempDir()
	if e := extract(makeZip(t, []string{"resources/valid.txt"}, false), dest); e != nil {
		t.Fatal(e)
	}
	if b, _ := os.ReadFile(filepath.Join(dest, "resources/valid.txt")); string(b) != "fixture" {
		t.Fatal("file missing")
	}
}
func TestArchiveHashAndLength(t *testing.T) {
	name := filepath.Join(t.TempDir(), "fixture")
	data := []byte("verified fixture")
	os.WriteFile(name, data, 0600)
	hash := sha512.Sum512(data)
	m := Manifest{Size: int64(len(data)), SHA512: hex.EncodeToString(hash[:])}
	if e := verifyArchive(name, m); e != nil {
		t.Fatal(e)
	}
	os.WriteFile(name, []byte("tampered fixture"), 0600)
	if e := verifyArchive(name, m); e == nil {
		t.Fatal("corrupt archive accepted")
	}
}
func TestActivateAndRollback(t *testing.T) {
	for _, result := range []string{"healthy", "exited", "unconfirmed", "start-fails"} {
		t.Run(result, func(t *testing.T) {
			dir := t.TempDir()
			root, stage, backup := filepath.Join(dir, "app"), filepath.Join(dir, "new"), filepath.Join(dir, "old")
			os.Mkdir(root, 0755)
			os.Mkdir(stage, 0755)
			os.WriteFile(filepath.Join(root, "version"), []byte("old"), 0600)
			os.WriteFile(filepath.Join(stage, "version"), []byte("new"), 0600)
			starts := 0
			phase, _ := activate(root, stage, backup, func(string) error {
				starts++
				if result == "start-fails" && starts == 1 {
					return errors.New("failed")
				}
				return nil
			}, func() string { return result })
			expected := "new"
			if result == "exited" || result == "start-fails" {
				expected = "old"
				if phase != "rolled-back" || starts != 2 {
					t.Fatal(phase, starts)
				}
			}
			b, _ := os.ReadFile(filepath.Join(root, "version"))
			if string(b) != expected {
				t.Fatal("wrong active version", string(b))
			}
			if result == "healthy" {
				b, _ = os.ReadFile(filepath.Join(backup, "version"))
				if string(b) != "old" {
					t.Fatal("backup lost")
				}
			}
		})
	}
}
func TestStableMonotonicVersions(t *testing.T) {
	if !newer("0.10.0", "0.9.4") {
		t.Fatal("new release rejected")
	}
	for _, v := range []string{"0.9.4", "0.9.3", "0.9.5-beta.1", "../x", "01.0.0"} {
		if newer(v, "0.9.4") {
			t.Fatal("invalid version", v)
		}
	}
}

// Optional release acceptance: validate and extract the actual full Windows package,
// without executing any Windows code on the build host.
func TestReleaseArchive(t *testing.T) {
	folder := os.Getenv("JOINCRAFT_RELEASE_TEST_DIR")
	if folder == "" {
		t.Skip("release acceptance not requested")
	}
	updatePublicKey = os.Getenv("JOINCRAFT_RELEASE_PUBLIC_KEY")
	m, e := manifest(folder)
	if e != nil {
		t.Fatal(e)
	}
	archive := filepath.Join(folder, "update.zip")
	if e = verifyArchive(archive, m); e != nil {
		t.Fatal(e)
	}
	dest := t.TempDir()
	if e = extract(archive, dest); e != nil {
		t.Fatal(e)
	}
	if e = checkMarker(dest, m.Version); e != nil {
		t.Fatal(e)
	}
}

func TestInstallerFilesSurviveUpdateAndRollback(t *testing.T) {
	for _, outcome := range []string{"healthy", "exited"} {
		t.Run(outcome, func(t *testing.T) {
			dir := t.TempDir()
			root, stage, backup := filepath.Join(dir, "app"), filepath.Join(dir, "new"), filepath.Join(dir, "old")
			os.Mkdir(root, 0755)
			os.Mkdir(stage, 0755)
			for _, name := range []string{"Uninstall joincraft.exe", "uninstallerIcon.ico"} {
				if e := os.WriteFile(filepath.Join(root, name), []byte("local installer "+name), 0644); e != nil {
					t.Fatal(e)
				}
			}
			os.WriteFile(filepath.Join(root, "old-code.dll"), []byte("never carry old code into the update"), 0644)
			os.WriteFile(filepath.Join(root, "version"), []byte("old"), 0644)
			os.WriteFile(filepath.Join(stage, "version"), []byte("new"), 0644)
			if e := preserveInstallerFiles(root, stage); e != nil {
				t.Fatal(e)
			}
			if _, e := os.Stat(filepath.Join(stage, "old-code.dll")); !os.IsNotExist(e) {
				t.Fatal("copied arbitrary old file")
			}
			phase, _ := activate(root, stage, backup, func(string) error { return nil }, func() string { return outcome })
			expectedPhase, expectedVersion := "complete", "new"
			if outcome == "exited" {
				expectedPhase, expectedVersion = "rolled-back", "old"
			}
			if phase != expectedPhase {
				t.Fatal(phase)
			}
			data, _ := os.ReadFile(filepath.Join(root, "version"))
			if string(data) != expectedVersion {
				t.Fatal("wrong active version")
			}
			for _, name := range []string{"Uninstall joincraft.exe", "uninstallerIcon.ico"} {
				data, e := os.ReadFile(filepath.Join(root, name))
				if e != nil || string(data) != "local installer "+name {
					t.Fatal("uninstaller lost", e)
				}
			}
		})
	}
}
func TestInstallerSupportFilesOptionalAndBounded(t *testing.T) {
	root, stage := t.TempDir(), t.TempDir()
	if e := preserveInstallerFiles(root, stage); e != nil {
		t.Fatal("ZIP-only client rejected", e)
	}
	name := filepath.Join(root, "Uninstall joincraft.exe")
	if e := os.Mkdir(name, 0755); e != nil {
		t.Fatal(e)
	}
	if e := preserveInstallerFiles(root, stage); e == nil {
		t.Fatal("directory accepted")
	}
	os.Remove(name)
	file, e := os.Create(name)
	if e != nil {
		t.Fatal(e)
	}
	if e = file.Truncate(32*1024*1024 + 1); e != nil {
		t.Fatal(e)
	}
	file.Close()
	if e := preserveInstallerFiles(root, stage); e == nil {
		t.Fatal("oversized metadata accepted")
	}
	os.WriteFile(name, []byte("local uninstaller"), 0644)
	os.WriteFile(filepath.Join(stage, "Uninstall joincraft.exe"), []byte("downloaded collision"), 0644)
	if e := preserveInstallerFiles(root, stage); e == nil {
		t.Fatal("bundle overwrote machine-local uninstaller")
	}
}
func TestInstallerSupportSymlinkRejected(t *testing.T) {
	root, stage := t.TempDir(), t.TempDir()
	target := filepath.Join(t.TempDir(), "outside")
	os.WriteFile(target, []byte("outside"), 0644)
	if e := os.Symlink(target, filepath.Join(root, "Uninstall joincraft.exe")); e != nil {
		t.Skip("symlinks unavailable on this platform")
	}
	if e := preserveInstallerFiles(root, stage); e == nil {
		t.Fatal("symlink followed")
	}
}
