// yosys: read_verilog {in}; hierarchy -auto-top; proc -norom; flatten; opt -keepdc; memory -nomap; write_json {out}
// memory_dff merges the read register into the memory: a synchronous read port.
module mem_sync_read (input clk, we, input [3:0] a, input [7:0] d, output reg [7:0] q);
  reg [7:0] m[0:15];
  always @(posedge clk) begin
    if (we) m[a] <= d;
    q <= m[a];
  end
endmodule
