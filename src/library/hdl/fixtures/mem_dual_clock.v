// A dual-clock memory: written on wclk, read into a register on rclk.
module mem_dual_clock (input wclk, rclk, we, input [3:0] wa, ra, input [7:0] d,
                       output reg [7:0] q);
  reg [7:0] m[0:15];
  always @(posedge wclk) if (we) m[wa] <= d;
  always @(posedge rclk) q <= m[ra];
endmodule
