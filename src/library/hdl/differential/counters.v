// Differential: counters and accumulators on one clock — a 64-bit counter, a signed
// accumulator, a 16-bit LFSR, a 40-bit multiply-accumulate, a 32 × 32 multiplier register.
module counters (
    input clk, input rst, input en, input signed [7:0] x, input [15:0] a, input [15:0] b,
    input [31:0] m, input [31:0] n,
    output reg [63:0] count, output reg signed [19:0] acc, output reg [15:0] lfsr,
    output reg [39:0] mac, output reg [63:0] product
);
  always @(posedge clk) begin
    if (rst) begin
      count <= 0;
      acc <= 0;
      lfsr <= 16'hace1;
      mac <= 0;
    end else begin
      if (en) count <= count + 1;
      acc <= acc + x;
      lfsr <= {lfsr[14:0], lfsr[15] ^ lfsr[13] ^ lfsr[12] ^ lfsr[10]};
      mac <= mac + a * b;
    end
    product <= m * n;
  end
endmodule
