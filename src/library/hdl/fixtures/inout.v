// A bidirectional port: refused until HDL-8.
module bidir (input oe, input [3:0] q, inout [3:0] d);
  assign d = oe ? q : 4'bz;
endmodule
