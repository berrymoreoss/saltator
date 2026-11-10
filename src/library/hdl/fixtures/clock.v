// A clock made inside the module (a gated clock): refused by HDL-1, run since HDL-9.
module clock (input clk, input en, output reg q);
  wire g = clk & en;
  always @(posedge g) q <= ~q;
endmodule
