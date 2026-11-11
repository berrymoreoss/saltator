// A reset loop over the array: a write port per word (an integer index: 32 address bits).
module mem_reset_loop (input clk, rst, we, input [1:0] a, input [7:0] d, output [7:0] q);
  reg [7:0] m[0:3];
  integer i;
  always @(posedge clk)
    if (rst) for (i = 0; i < 4; i = i + 1) m[i] <= 0;
    else if (we) m[a] <= d;
  assign q = m[a];
endmodule
