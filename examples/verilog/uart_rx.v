// A UART receiver, 8N1, on the transmitter's clock. A falling edge of rx starts a byte; each bit
// is sampled in its middle, DIVISOR clocks apart. At a good stop bit (1), data takes the byte
// and valid goes to 1; a stop bit at 0 is a framing error (err). Both hold until the next byte.
module uart_rx #(parameter DIVISOR = 8) (
    input clk, input rst, input rx,
    output reg [7:0] data = 8'd0, output reg valid = 1'b0, output reg err = 1'b0
);
  reg [7:0] shift = 8'd0;
  reg [3:0] at = 4'd0;        // 0 idle, 1 the start bit, 2-9 the data bits, 10 the stop bit
  reg [7:0] tick = 8'd0;      // clocks into the current bit
  reg last = 1'b1;            // rx a clock ago: its falling edge starts a byte
  always @(posedge clk) begin
    last <= rx;
    if (rst) begin
      at <= 4'd0;
      tick <= 8'd0;
      valid <= 1'b0;
      err <= 1'b0;
    end else if (at == 4'd0) begin
      if (last && !rx) begin
        at <= 4'd1;
        tick <= 8'd0;
        valid <= 1'b0;
        err <= 1'b0;
      end
    end else if (tick == (at == 4'd1 ? DIVISOR / 2 - 1 : DIVISOR - 1)) begin
      // The middle of a bit.
      tick <= 8'd0;
      if (at == 4'd1) at <= rx ? 4'd0 : 4'd2;  // a glitch is no start bit
      else if (at <= 4'd9) begin
        shift <= {rx, shift[7:1]};
        at <= at + 1;
      end else begin
        at <= 4'd0;
        if (rx) begin
          data <= shift;
          valid <= 1'b1;
        end else err <= 1'b1;
      end
    end else tick <= tick + 1;
  end
endmodule
