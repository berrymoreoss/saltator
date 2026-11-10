// HDL-9: races a board can't promise — a gated clock and a divided clock sampling a register
// that the same edge of clk changes: X where it changed, reported.
module races (
    input clk, input en, input [3:0] d,
    output reg [3:0] q, output reg [3:0] gated, output reg [3:0] divided
);
  always @(posedge clk) q <= d;
  wire g = clk & en;
  always @(posedge g) gated <= q;
  reg div = 1'b0;
  always @(posedge clk) div <= ~div;
  always @(posedge div) divided <= q;
endmodule
