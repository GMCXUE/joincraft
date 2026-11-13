package main

import (
	"errors"
	"os/exec"
	"strings"
	"syscall"
	"unsafe"
)

func parentHandle(pid int, expected string) (func() error, func(), error) {
	dll := syscall.NewLazyDLL("kernel32.dll")
	open := dll.NewProc("OpenProcess")
	query := dll.NewProc("QueryFullProcessImageNameW")
	wait := dll.NewProc("WaitForSingleObject")
	close := dll.NewProc("CloseHandle")
	h, _, e := open.Call(0x100000|0x1000, 0, uintptr(pid))
	if h == 0 {
		return nil, nil, e
	}
	cleanup := func() { close.Call(h) }
	buf := make([]uint16, 32768)
	size := uint32(len(buf))
	ok, _, _ := query.Call(h, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)))
	if ok == 0 || !strings.EqualFold(syscall.UTF16ToString(buf[:size]), expected) {
		cleanup()
		return nil, nil, errors.New("parent executable mismatch")
	}
	return func() error {
		result, _, _ := wait.Call(h, 90000)
		if result != 0 {
			return errors.New("parent did not exit")
		}
		return nil
	}, cleanup, nil
}
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000200 | 0x00000008, HideWindow: true}
}
