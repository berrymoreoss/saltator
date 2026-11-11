// yosys: read_verilog {in}; hierarchy -auto-top; proc -norom; flatten; opt -keepdc; memory -nomap -nordff; write_json {out}
// memory_share makes the two byte writes one wide port: its words come as ports of their own.
module mem_wide (input clk, we, input [3:0] a, input [15:0] d, output [7:0] q);
  reg [7:0] m[0:15];
  always @(posedge clk)
    if (we) begin
      m[{a[3:1], 1'b0}] <= d[7:0];
      m[{a[3:1], 1'b1}] <= d[15:8];
    end
  assign q = m[a];
endmodule
