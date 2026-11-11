// Two write ports on one clock: the later statement wins where both write.
module mem_two_writes (input clk, w1, w2, input [2:0] a1, a2, ra, input [3:0] d1, d2,
                       output [3:0] q);
  reg [3:0] m[0:7];
  always @(posedge clk) begin
    if (w1) m[a1] <= d1;
    if (w2) m[a2] <= d2;
  end
  assign q = m[ra];
endmodule
