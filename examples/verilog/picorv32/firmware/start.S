# Start-up: the stack at the top of the RAM, .bss cleared, then main. Should main return, EBREAK
# stops the core and its trap output rises.

  .section .text.start, "ax"
  .globl _start
_start:
  li sp, 0x1000             # the stack grows down from the end of the 4 KB RAM
  la a0, __bss_start
  la a1, __bss_end
clear:
  bgeu a0, a1, run
  sw zero, 0(a0)
  addi a0, a0, 4
  j clear
run:
  call main
  ebreak
