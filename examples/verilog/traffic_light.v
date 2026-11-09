// A traffic light state machine: RED -> GREEN -> YELLOW -> RED, one step per clock edge
// while tick is HIGH; a synchronous reset to RED.
module traffic_light (
    input clk,
    input rst,
    input tick,
    output red,
    output yellow,
    output green
);
  localparam RED = 2'd0, GREEN = 2'd1, YELLOW = 2'd2;
  reg [1:0] state;
  always @(posedge clk)
    if (rst) state <= RED;
    else if (tick)
      case (state)
        RED: state <= GREEN;
        GREEN: state <= YELLOW;
        default: state <= RED;
      endcase
  assign red = state == RED || state == 2'd3;
  assign yellow = state == YELLOW;
  assign green = state == GREEN;
endmodule
