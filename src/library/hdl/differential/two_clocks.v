// Differential (HDL-6): written on one clock, read into a register on another, and a memory
// written on a clock made by logic (every other edge of clk_w).
module two_clocks (input clk_w, input clk_r, input we, input [3:0] wa, ra, input [7:0] d,
                   output reg [7:0] q, output [3:0] h);
  reg [7:0] m[0:15];
  reg [3:0] half[0:3];
  reg div = 0;
  always @(posedge clk_w) begin
    div <= ~div;
    if (we) m[wa] <= d;
  end
  always @(posedge clk_r) q <= m[ra];
  always @(posedge div) if (we) half[wa[1:0]] <= d[3:0];
  assign h = half[ra[1:0]];
endmodule
