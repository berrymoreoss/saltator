// HDL-9: words wider than 32 bits — a 64-bit counter, a 32 × 32 multiplier, a 72-bit sum,
// comparison and shift, a 40-bit multiplexer.
module wide_ops (
    input clk, input rst, input [31:0] a, input [31:0] b, input [71:0] x, input [71:0] y,
    input [6:0] n, input s,
    output reg [63:0] count, output [63:0] prod, output [71:0] sum, output less,
    output [71:0] shifted, output [39:0] picked
);
  always @(posedge clk) if (rst) count <= 0; else count <= count + 1;
  assign prod = a * b;
  assign sum = x + y;
  assign less = x < y;
  assign shifted = x << n;
  assign picked = s ? x[39:0] : y[39:0];
endmodule
