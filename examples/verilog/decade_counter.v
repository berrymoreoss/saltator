// A decade counter: counts 0-9 on rising clock edges while enabled, carries at 9,
// and resets asynchronously.
module decade_counter (
    input clk,
    input rst,
    input en,
    output reg [3:0] q,
    output co
);
  always @(posedge clk or posedge rst)
    if (rst) q <= 4'd0;
    else if (en) q <= (q == 4'd9) ? 4'd0 : q + 4'd1;
  assign co = en & (q == 4'd9);
endmodule
