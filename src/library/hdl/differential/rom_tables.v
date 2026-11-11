// Differential (HDL-6): ROMs — from $readmemh, from initial loops, addressed from 16 (reads
// outside 16..25 are x), read at once and on a clock.
module rom_tables (input clk, input [3:0] a, input [4:0] b,
                   output [7:0] t, output reg [7:0] tq, output [11:0] sq, output [7:0] o);
  reg [7:0] table_[0:15];
  reg [11:0] squares[0:15];
  reg [7:0] window[16:25];
  integer i;
  initial begin
    $readmemh("rom_tables.hex", table_);
    for (i = 0; i < 16; i = i + 1) squares[i] = i * i * 13;
    for (i = 16; i <= 25; i = i + 1) window[i] = i * 7;
  end
  assign t = table_[a];
  always @(posedge clk) tq <= table_[a];
  assign sq = squares[a];
  assign o = window[b];
endmodule
