// A traffic light: RED -> GREEN -> YELLOW -> RED on each tick, synchronous reset (active LOW).
module traffic (
    input clk,
    input rst_n,
    input tick,
    output reg [2:0] lights,
    output [1:0] st
);
  localparam RED = 2'd0, GREEN = 2'd1, YELLOW = 2'd2;
  reg [1:0] state;
  assign st = state;
  always @(posedge clk)
    if (!rst_n) state <= RED;
    else if (tick)
      case (state)
        RED: state <= GREEN;
        GREEN: state <= YELLOW;
        default: state <= RED;
      endcase
  always @* begin
    case (state)
      RED: lights = 3'b100;
      GREEN: lights = 3'b001;
      YELLOW: lights = 3'b010;
      default: lights = 3'b111;
    endcase
  end
endmodule
