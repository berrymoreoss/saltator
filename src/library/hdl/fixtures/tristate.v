// A tri-state output (HDL-8), read inside the module too: released, it reads X there.
module tristate (input oe, input [3:0] a, output [3:0] y, output [3:0] t);
  assign y = oe ? a : 4'bz;
  assign t = ~y;
endmodule
