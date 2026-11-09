// A tri-state output: refused until HDL-8.
module tristate (input oe, input [3:0] a, output [3:0] y);
  assign y = oe ? a : 4'bz;
endmodule
