// 74HC00: quad 2-input NAND gate, as a library part written in Verilog (HDL-2).
// Timing: Nexperia 74HC_HCT00 product data sheet, rev. 11 (29 April 2025), table 7, at
// VCC = 4.5 V, CL = 50 pF — tpd typ 9 ns (25 °C), max 23 ns (−40 °C to +85 °C). Delays in ns,
// min:typ:max, (rise, fall): Yosys keeps a lone triple's typical value only.

// One gate (n = 1 to 4): nY = !(nA & nB).
module hc00_gate (
    input  A,
    input  B,
    output Y
);
  assign Y = ~(A & B);
  specify
    (A => Y) = (9:9:23, 9:9:23);
    (B => Y) = (9:9:23, 9:9:23);
  endspecify
endmodule

// The chip: gate n on A[n-1], B[n-1], Y[n-1] (pins 1A … 4Y).
module hc00 (
    input  [3:0] A,
    input  [3:0] B,
    output [3:0] Y
);
  hc00_gate gate1 (A[0], B[0], Y[0]);
  hc00_gate gate2 (A[1], B[1], Y[1]);
  hc00_gate gate3 (A[2], B[2], Y[2]);
  hc00_gate gate4 (A[3], B[3], Y[3]);
endmodule
