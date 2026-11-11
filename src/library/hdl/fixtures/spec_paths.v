// Pin-to-pin delays (HDL-2): simple paths with rise and fall (min:typ:max, decimals), a parallel
// and a full path between vectors, an edge-sensitive path, conditional paths.
module spec_paths (
    input a,
    input b,
    input [1:0] s,
    input clk,
    input d,
    input en,
    output y,
    output [1:0] p,
    output [1:0] f,
    output reg q,
    output g
);
  assign y = ~(a & b);
  assign p = ~s;
  assign f = s + 2'd1;
  always @(posedge clk) q <= d;
  assign g = en & a;
  specify
    (a => y) = (9:9:23, 8:8:20);
    (b => y) = (9.5, 10);
    (s => p) = 5;
    (s *> f) = (6:7:8);
    (posedge clk => (q +: d)) = (17:17:44, 18:18:45);
    if (en) (a => g) = 12;
    (en => g) = 11;
  endspecify
endmodule
