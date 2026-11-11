// A ROM loaded by $readmemh (Yosys reads mem_rom.hex next to this file), read on a clock.
module mem_rom (input clk, input [3:0] a, output reg [7:0] q);
  reg [7:0] rom[0:15];
  initial $readmemh("mem_rom.hex", rom);
  always @(posedge clk) q <= rom[a];
endmodule
