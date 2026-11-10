// HDL-9: flip-flops clocked and reset from inside the module, with no race — a divider and the
// counter it clocks, a shift chain on the divided clock, a ripple counter, a decade counter that
// clears itself through an asynchronous reset made by logic.
module clocks (
    input clk, input [3:0] d,
    output reg [3:0] slow = 4'd0, output reg [3:0] s1, output reg [3:0] s2, output [3:0] ripple,
    output reg [3:0] decade = 4'd0
);
  reg div = 1'b0;
  always @(posedge clk) div <= ~div;
  always @(posedge div) slow <= slow + 1;
  always @(posedge div) begin
    s1 <= d;
    s2 <= s1;
  end
  reg [3:0] rip = 4'd0;
  always @(posedge clk) rip[0] <= ~rip[0];
  always @(negedge rip[0]) rip[1] <= ~rip[1];
  always @(negedge rip[1]) rip[2] <= ~rip[2];
  always @(negedge rip[2]) rip[3] <= ~rip[3];
  assign ripple = rip;
  wire ten = decade == 4'd10;
  always @(posedge clk or posedge ten) if (ten) decade <= 4'd0; else decade <= decade + 1;
endmodule
