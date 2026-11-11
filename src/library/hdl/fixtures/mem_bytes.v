// 16-bit words written a byte at a time (byte enables).
module mem_bytes (input clk, input [1:0] we, input [3:0] a, input [15:0] d, output [15:0] q);
  reg [15:0] m[0:15];
  always @(posedge clk) begin
    if (we[0]) m[a][7:0] <= d[7:0];
    if (we[1]) m[a][15:8] <= d[15:8];
  end
  assign q = m[a];
endmodule
