// Differential (HDL-6): 16-bit words written a byte at a time, and a whole-word port. They
// write different halves: Yosys's sim loops on two ports writing one bit at one edge.
module byte_lanes (input clk, input [1:0] we, input w2, input [1:0] a, a2, input [2:0] ra,
                   input [15:0] d, input [15:0] d2, output [15:0] q);
  reg [15:0] m[0:7];
  always @(posedge clk) begin
    if (we[0]) m[{1'b0, a}][7:0] <= d[7:0];
    if (we[1]) m[{1'b0, a}][15:8] <= d[15:8];
    if (w2) m[{1'b1, a2}] <= d2;
  end
  assign q = m[ra];
endmodule
