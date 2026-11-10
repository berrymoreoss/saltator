// HDL-9: multiplication, division, remainder, powers and === on unsigned operands.
module arith (
    input [7:0] a, input [7:0] b, input [2:0] n,
    output [15:0] mul, output [7:0] div, output [7:0] mod, output [7:0] pow, output [7:0] pow2,
    output eqx, output nex
);
  assign mul = a * b;
  assign div = a / b;
  assign mod = a % b;
  assign pow = a ** n;
  assign pow2 = 2 ** n;
  assign eqx = a === b;
  assign nex = a !== b;
endmodule
