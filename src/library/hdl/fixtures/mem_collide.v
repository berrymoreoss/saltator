// Two always blocks write one memory on one clock: neither wins where both write a word.
module mem_collide (input clk, w1, w2, input [2:0] a1, a2, ra, input [3:0] d1, d2,
                    output [3:0] q);
  reg [3:0] m[0:7];
  always @(posedge clk) if (w1) m[a1] <= d1;
  always @(posedge clk) if (w2) m[a2] <= d2;
  assign q = m[ra];
endmodule
