// A memory written on a clock made by logic: every other edge of clk.
module mem_divided (input clk, we, input [1:0] a, input [3:0] d, output [3:0] q);
  reg div = 0;
  reg [3:0] m[0:3];
  always @(posedge clk) div <= ~div;
  always @(posedge div) if (we) m[a] <= d;
  assign q = m[a];
endmodule
