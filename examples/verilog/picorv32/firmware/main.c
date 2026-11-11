// The PicoRV32 example's program: the switches on the input port say n, the output port shows
// the n-th Fibonacci number as a byte (modulo 256: F(13) = 233 is the last one below 256).
// Built by `pnpm riscv:firmware` (README.md); firmware.lst shows the instructions it became.

#include <stdint.h>

// The ports of soc.v, as memory: a store to OUT sets the LEDs, a load from IN reads the switches.
#define OUT (*(volatile uint32_t *)0x10000000)
#define IN (*(volatile uint32_t *)0x10000004)

// F(0) = 0, F(1) = 1, F(n) = F(n - 1) + F(n - 2), each sum a byte as the port shows it.
static uint8_t fibonacci(uint8_t n) {
  uint8_t a = 0;
  uint8_t b = 1;
  while (n-- > 0) {
    uint8_t sum = a + b;
    a = b;
    b = sum;
  }
  return a;
}

int main(void) {
  for (;;) {
    OUT = fibonacci(IN & 0xff);
  }
}
