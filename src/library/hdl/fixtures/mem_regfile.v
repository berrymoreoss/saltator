// A register file: two asynchronous read ports, one write port (HDL-6).
module mem_regfile (input clk, we, input [2:0] rs1, rs2, rd, input [7:0] wd,
                    output [7:0] r1, r2);
  reg [7:0] regs[0:7];
  always @(posedge clk) if (we) regs[rd] <= wd;
  assign r1 = regs[rs1];
  assign r2 = regs[rs2];
endmodule
