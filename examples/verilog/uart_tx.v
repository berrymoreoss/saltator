// A UART transmitter, 8N1. A rising edge of start while idle sends data: a start bit (0), the
// eight data bits least significant first, a stop bit (1), each DIVISOR clocks long. busy is 1
// while it sends; the line idles at 1. Everything starts idle at power-up (init values).
module uart_tx #(parameter DIVISOR = 8) (
    input clk, input rst, input start, input [7:0] data,
    output tx, output busy
);
  reg [9:0] shift = 10'h3ff;  // what goes out, bit 0 first: {stop, data, start}
  reg [3:0] left = 4'd0;      // bits still to send
  reg [7:0] tick = 8'd0;      // clocks into the current bit
  reg last = 1'b0;            // start a clock ago: its rising edge starts a byte
  assign tx = shift[0];
  assign busy = left != 4'd0;
  always @(posedge clk) begin
    last <= start;
    if (rst) begin
      shift <= 10'h3ff;
      left <= 4'd0;
      tick <= 8'd0;
    end else if (!busy) begin
      if (start && !last) begin
        shift <= {1'b1, data, 1'b0};
        left <= 4'd10;
        tick <= 8'd0;
      end
    end else if (tick == DIVISOR - 1) begin
      tick <= 8'd0;
      shift <= {1'b1, shift[9:1]};
      left <= left - 1;
    end else tick <= tick + 1;
  end
endmodule
