// An initial value: the flip-flop starts at it (HDL-9; HDL-1 warned and started it unknown).
module init (input clk, output reg q = 1'b1);
  always @(posedge clk) q <= ~q;
endmodule
