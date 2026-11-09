// A bidirectional port (HDL-8): driven while oe, read back from the pins always.
module bidir (input oe, input [3:0] q, inout [3:0] d, output [3:0] r);
  assign d = oe ? q : 4'bz;
  assign r = d;
endmodule
