// A 32-bit RAM read at once: a soft core's memory, in small (HDL-6).
module mem_word32 (input clk, we, input [3:0] a, input [31:0] d, output [31:0] q);
  reg [31:0] ram[0:15];
  always @(posedge clk) if (we) ram[a] <= d;
  assign q = ram[a];
endmodule
