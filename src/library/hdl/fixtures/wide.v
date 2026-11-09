// A 33-bit port: refused until HDL-9.
module wide (input [32:0] a, output [32:0] y);
  assign y = a + 1;
endmodule
