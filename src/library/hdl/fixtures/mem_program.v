// A 32-bit RAM holding a program read by $readmemh: the e2e test's soft-core memory (HDL-6).
module mem_program (input clk, we, input [3:0] a, input [31:0] d, output [31:0] q);
  reg [31:0] ram[0:15];
  initial $readmemh("mem_program.hex", ram);
  always @(posedge clk) if (we) ram[a] <= d;
  assign q = ram[a];
endmodule
