// A latch and a latch with an asynchronous reset (both inferred: Yosys warns).
module latches (
    input en,
    input rst,
    input [1:0] d,
    output reg [1:0] q,
    output reg r
);
  always @* if (en) q = d;
  always @* if (rst) r = 1'b0; else if (en) r = d[0];
endmodule
