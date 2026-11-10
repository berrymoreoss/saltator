// Differential: clocks made inside the module, with no race — a divider and the counter it
// clocks, a shift chain on the divided clock, a ripple counter, a divide-by-3 clock from a
// registered compare. (A counter clearing itself through a reset made from its own output —
// clocks.v's decade — loops Yosys's sim forever: a unit test only.)
module dividers (
    input clk, input [3:0] d,
    output reg [3:0] slow = 4'd0, output reg [3:0] s1, output reg [3:0] s2, output [3:0] ripple,
    output reg [7:0] by3 = 8'd0
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
  reg [1:0] c3 = 2'd0;
  reg q3 = 1'b0;
  always @(posedge clk) begin
    c3 <= c3 == 2'd2 ? 2'd0 : c3 + 1;
    q3 <= c3 == 2'd2;
  end
  always @(posedge q3) by3 <= by3 + 1;
endmodule
