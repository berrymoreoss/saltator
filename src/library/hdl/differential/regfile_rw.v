// Differential (HDL-6): a register file — two asynchronous reads, a registered read, one write.
module regfile_rw (input clk, input we, input [3:0] rs1, rs2, rd, input [7:0] wd,
                   output [7:0] r1, r2, output reg [7:0] rq);
  reg [7:0] regs[0:15];
  always @(posedge clk) begin
    if (we) regs[rd] <= wd;
    rq <= regs[rs1];
  end
  assign r1 = regs[rs1];
  assign r2 = regs[rs2];
endmodule
