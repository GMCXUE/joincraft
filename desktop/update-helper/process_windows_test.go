package main

import "testing"

func TestRestartWindowIsVisible(t *testing.T) {
	cmd := clientCommand(t.TempDir(), "test-token", t.TempDir())
	if cmd.SysProcAttr == nil || cmd.SysProcAttr.HideWindow || cmd.SysProcAttr.CreationFlags&0x00000008 == 0 {
		t.Fatal("restart must detach without SW_HIDE")
	}
}
