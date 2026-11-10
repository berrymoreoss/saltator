// HDL-9: signed operands — extension, arithmetic, division, powers, comparisons, arithmetic
// shifts — and the signed cells unsigned code makes (a bit set at a variable index, a variable
// part-select).
module signed_ops (
    input signed [7:0] a, input signed [7:0] b, input signed [3:0] c, input [2:0] n,
    input [1:0] sel, input [15:0] v,
    output signed [8:0] sum, output signed [7:0] diff, output signed [15:0] prod,
    output signed [7:0] quot, output signed [7:0] rem, output signed [7:0] power,
    output signed [7:0] widened, output lt, output ge, output signed [7:0] sar,
    output signed [7:0] neg, output [3:0] onehot, output [3:0] slice
);
  assign sum = a + b;
  assign diff = a - b;
  assign prod = a * b;
  assign quot = a / b;
  assign rem = a % b;
  assign power = a ** c;
  assign widened = c;
  assign lt = a < b;
  assign ge = a >= b;
  assign sar = a >>> n;
  assign neg = -c;
  reg [3:0] d;
  always @* begin
    d = 4'b0;
    d[sel] = 1'b1;
  end
  assign onehot = d;
  assign slice = v[n * 2 +: 4];
endmodule
