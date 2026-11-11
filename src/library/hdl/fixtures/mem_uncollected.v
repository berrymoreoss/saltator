// yosys: read_verilog {in}; hierarchy -auto-top; proc -norom; flatten; opt -keepdc; write_json {out}
// Without memory_collect a memory is separate read, write and init cells.
module mem_uncollected (input clk, we, input [1:0] a, input [7:0] d, output [7:0] q);
  reg [7:0] m[0:3];
  initial m[0] = 8'h42;
  always @(posedge clk) if (we) m[a] <= d;
  assign q = m[a];
endmodule
