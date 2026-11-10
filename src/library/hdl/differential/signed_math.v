// Differential: signed arithmetic at 8 and 40 bits — division and remainder of every sign,
// products, arithmetic shifts, comparisons, a quotient sign-extended into a wider result.
module signed_math (
    input signed [7:0] a, input signed [7:0] b, input signed [39:0] c, input signed [39:0] d,
    input signed [3:0] e, input [2:0] n,
    output signed [7:0] q8, output signed [7:0] r8, output signed [39:0] q40,
    output signed [39:0] r40, output signed [15:0] p16, output signed [79:0] p80,
    output signed [7:0] sar8, output signed [39:0] sar40, output lt8, output lt40,
    output signed [15:0] wide_q, output signed [39:0] mixed_q, output signed [7:0] small_q
);
  assign q8 = a / b;
  assign r8 = a % b;
  assign q40 = c / d;
  assign r40 = c % d;
  assign p16 = a * b;
  assign p80 = c * d;
  assign sar8 = a >>> n;
  assign sar40 = c >>> n;
  assign lt8 = a < b;
  assign lt40 = c < d;
  assign wide_q = a / b;
  assign mixed_q = c / a;
  assign small_q = a / e;
endmodule
