// A register file: a memory, refused until HDL-6.
module memory (input clk, input we, input [1:0] a, input [7:0] d, output [7:0] q);
  reg [7:0] r[0:3];
  always @(posedge clk) if (we) r[a] <= d;
  assign q = r[a];
endmodule
