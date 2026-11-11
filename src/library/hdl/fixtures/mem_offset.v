// A memory addressed from 16 (m[16:25]), its words set by an initial loop.
module mem_offset (input clk, we, input [4:0] a, input [7:0] d, output [7:0] q);
  reg [7:0] m[16:25];
  integer i;
  initial for (i = 16; i <= 25; i = i + 1) m[i] = i;
  always @(posedge clk) if (we) m[a] <= d;
  assign q = m[a];
endmodule
