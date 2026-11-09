// Every combinational operator of HDL-1 and the flip-flop flavours opt leaves.
module ops (
    input clk, input rst, input en,
    input [7:0] a, input [7:0] b, input [2:0] n,
    output [7:0] arith, output reduce, output logic, output ge, output any_b, output pick,
    output dc, output [7:0] negsum, output [7:0] shr, output [7:0] sshr,
    output reg [7:0] r_sdff, output reg [7:0] r_dffe, output reg [7:0] r_neg, output reg r_sdffce,
    output reg [7:0] r_sdffe, output reg [3:0] r_adff
);
  assign arith = (a - b) ^ ~(a | b) ^ (a ~^ b) ^ (a & b);
  assign reduce = &a | ^b | ~|a | ~^b;
  assign logic = (a != b) && (a <= b) || !(a > b) || (a < b);
  assign ge = a >= b;
  assign any_b = |b;
  assign pick = a[0] ? b[1] : b[2];
  assign dc = a == 8'hx5;
  assign negsum = -a + +b;
  assign shr = a >> n;
  assign sshr = a >>> n;
  always @(posedge clk) if (rst) r_sdff <= 0; else r_sdff <= a;
  always @(posedge clk) if (en) r_dffe <= b;
  always @(negedge clk) r_neg <= a & b;
  always @(posedge clk) if (en) begin if (rst) r_sdffce <= 1; else r_sdffce <= a[3]; end
  always @(posedge clk) if (rst) r_sdffe <= 8'h5a; else if (en) r_sdffe <= b;
  always @(negedge clk or negedge en) if (!en) r_adff <= 4'b1010; else r_adff <= a[3:0];
endmodule
