// An initial value: not simulated until HDL-9 (a warning), the flip-flop starts unknown.
module init (input clk, output reg q = 1'b1);
  always @(posedge clk) q <= ~q;
endmodule
