//go:build !windows

package main

import (
	"errors"
	"os/exec"
)

func parentHandle(pid int, expected string) (func() error, func(), error) {
	return nil, nil, errors.New("Windows helper only")
}
func detach(cmd *exec.Cmd) {}
