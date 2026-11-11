// Timing the simulator doesn't model (HDL-2): a skew check, recovery and removal in one, a
// negative hold, a third delay (Yosys keeps rise and fall and warns).
module spec_unsupported (
    input clk,
    input clk2,
    input rn,
    input d,
    output reg q,
    output y
);
  always @(posedge clk) q <= d;
  assign y = ~d;
  specify
    (d => y) = (3, 4, 5);
    $skew(posedge clk, posedge clk2, 2);
    $recrem(posedge rn, posedge clk, 5, 1);
    $hold(posedge clk, d, -2);
  endspecify
endmodule
