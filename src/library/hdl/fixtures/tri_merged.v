// Two drivers of one inout port: tribuf -logic merges them into one (both enabled: X).
module tri_merged (input oe1, input oe2, input [3:0] a, input [3:0] b, inout [3:0] y, output [3:0] r);
  assign y = oe1 ? a : 4'bz;
  assign y = oe2 ? b : 4'bz;
  assign r = y;
endmodule
