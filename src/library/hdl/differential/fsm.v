// Differential: a state machine — an asynchronous active-low reset, a case on the state, a
// register loaded and rotated, an output decoded from the state.
module fsm (
    input clk, input rst_n, input [1:0] cmd, input [7:0] data,
    output reg [1:0] state, output reg [7:0] r, output busy
);
  localparam IDLE = 2'd0, LOAD = 2'd1, SHIFT = 2'd2, DONE = 2'd3;
  always @(posedge clk or negedge rst_n)
    if (!rst_n) begin
      state <= IDLE;
      r <= 8'd0;
    end else
      case (state)
        IDLE: if (cmd == 2'd1) state <= LOAD;
        LOAD: begin
          r <= data;
          state <= SHIFT;
        end
        SHIFT: begin
          r <= {r[6:0], r[7]};
          if (cmd == 2'd2) state <= DONE;
        end
        DONE: state <= IDLE;
      endcase
  assign busy = state != IDLE;
endmodule
